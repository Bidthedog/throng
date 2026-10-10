/**
 * One fold state per document or standalone preview (047, data-model.md "FoldState", research R3).
 *
 * `base` is the section state everything starts at; `flipped` lists the slugs that differ from it —
 * so a document's initial state costs one Collapse/Expand All to reach whatever the reader wants,
 * rather than an entry per heading. Every operation here is pure; the holder (main's
 * `EditorCoordinator`, beside word wrap) is not this module's concern.
 *
 * `flipped` is always kept sorted and de-duplicated, so two states reaching the same set compare
 * equal with a plain `toEqual` and a no-op update relays nothing new.
 */
import type { DocumentSymbol } from './document-symbol.js';

export interface FoldState {
  base: 'expanded' | 'collapsed';
  /** Slugs whose collapsed state differs from `base`; sorted, unique. */
  flipped: readonly string[];
}

function withFlipped(state: FoldState, flipped: readonly string[]): FoldState {
  return { base: state.base, flipped };
}

/** `{ base: pref, flipped: [] }`. */
export function initialFold(pref: 'expanded' | 'collapsed'): FoldState {
  return { base: pref, flipped: [] };
}

/** `(base === 'collapsed') !== flipped.includes(slug)`. */
export function isCollapsed(state: FoldState, slug: string): boolean {
  return (state.base === 'collapsed') !== state.flipped.includes(slug);
}

/** Adds or removes `slug` in `flipped` so `isCollapsed(result, slug) === collapsed`; other slugs untouched. */
export function setSection(state: FoldState, slug: string, collapsed: boolean): FoldState {
  const wants = collapsed !== (state.base === 'collapsed'); // must slug be flipped to reach `collapsed`?
  const has = state.flipped.includes(slug);
  if (wants === has) return state;
  const flipped = wants
    ? [...state.flipped, slug].sort()
    : state.flipped.filter((s) => s !== slug);
  return withFlipped(state, flipped);
}

/** `setSection(state, slug, !isCollapsed(state, slug))`. */
export function toggleSection(state: FoldState, slug: string): FoldState {
  return setSection(state, slug, !isCollapsed(state, slug));
}

/** `{ base: 'collapsed', flipped: [] }` (FR-037a) — every section individually collapsed. */
export function collapseAll(_state: FoldState): FoldState {
  return { base: 'collapsed', flipped: [] };
}

/** `{ base: 'expanded', flipped: [] }` (FR-037a) — every section individually expanded. */
export function expandAll(_state: FoldState): FoldState {
  return { base: 'expanded', flipped: [] };
}

/** `collapseAll` when any of `slugs` is expanded, else `expandAll`. */
export function toggleAll(state: FoldState, slugs: readonly string[]): FoldState {
  const anyExpanded = slugs.some((slug) => !isCollapsed(state, slug));
  return anyExpanded ? collapseAll(state) : expandAll(state);
}

/** Drops `flipped` entries for slugs no longer present (removed headings). */
export function prune(state: FoldState, slugs: readonly string[]): FoldState {
  const present = new Set(slugs);
  const flipped = state.flipped.filter((slug) => present.has(slug));
  return flipped.length === state.flipped.length ? state : withFlipped(state, flipped);
}

/** Every ancestor of `slug` in `tree`, root first, followed by `slug` itself — or `[]` when not found. */
function pathTo(tree: readonly DocumentSymbol[], slug: string): DocumentSymbol[] {
  for (const node of tree) {
    if (node.slug === slug) return [node];
    const nested = pathTo(node.children, slug);
    if (nested.length > 0) return [node, ...nested];
  }
  return [];
}

/** `slug`'s node and every node nested under it, or `[]` when `slug` is not in `tree`. */
function subtreeOf(tree: readonly DocumentSymbol[], slug: string): DocumentSymbol[] {
  const node = pathTo(tree, slug).at(-1);
  if (node === undefined) return [];
  const out: DocumentSymbol[] = [];
  const walk = (n: DocumentSymbol): void => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/**
 * 054 FR-013 — Collapse All Inside This Section: `slug` and every section nested under it, each set
 * individually (047 FR-037a's rule, scoped); every other section untouched. A leaf is its own section.
 */
export function collapseWithin(state: FoldState, tree: readonly DocumentSymbol[], slug: string): FoldState {
  return subtreeOf(tree, slug).reduce((acc, node) => setSection(acc, node.slug, true), state);
}

/** 054 FR-013 — Expand All Inside This Section; {@link collapseWithin}'s mirror. */
export function expandWithin(state: FoldState, tree: readonly DocumentSymbol[], slug: string): FoldState {
  return subtreeOf(tree, slug).reduce((acc, node) => setSection(acc, node.slug, false), state);
}

/** Expands `slug`'s section and every ancestor of it, leaving every other slug untouched (FR-040). */
export function revealing(state: FoldState, tree: readonly DocumentSymbol[], slug: string): FoldState {
  const path = pathTo(tree, slug);
  return path.reduce((acc, node) => setSection(acc, node.slug, false), state);
}

/** The set of sections actually shown: hidden when any ancestor is collapsed. */
export function visibleSections(state: FoldState, tree: readonly DocumentSymbol[]): Set<string> {
  const visible = new Set<string>();
  const walk = (nodes: readonly DocumentSymbol[], ancestorCollapsed: boolean): void => {
    for (const node of nodes) {
      if (!ancestorCollapsed) visible.add(node.slug);
      walk(node.children, ancestorCollapsed || isCollapsed(state, node.slug));
    }
  };
  walk(tree, false);
  return visible;
}

/**
 * The preview's find TEXT MODEL (047, US1, research.md R1).
 *
 * Find in a preview runs over RENDERED text, not markdown source: `**bold**` is found as `bold`
 * (FR-002), because by the time this walk runs the body has already turned it into
 * `<strong>bold</strong>` and the walk only ever sees the plain text inside. A `TreeWalker`-shaped
 * traversal over the body concatenates every text node into one string and records, for every run of
 * characters, which node it came from — so a match found in the concatenated string can be turned back
 * into a `Range` over the real DOM (`locate`).
 *
 * ══ WHAT IS EXCLUDED, AND WHY THIS IS THE ONE PLACE THAT DECIDES ══
 *
 * Two things must never become searchable text: an `aria-hidden` subtree (hidden front matter, and
 * anything else the body marks as not really there), and the fold gutter/toggle controls themselves —
 * their glyph is chrome, not content, and matching "▸" would be absurd. **Collapsed sections are the
 * opposite case and are deliberately NOT excluded**: folding hides a section visually, not from Find
 * (edge case "Find across a fold" — the current match reveals its section through the fold API before
 * scrolling to it, FR-040). A section is ordinary content the reader chose not to look at right now.
 *
 * ══ WHY A STRUCTURAL NODE TYPE, NOT `Node` ══
 *
 * The unit project runs in Node with no DOM (`scroll-anchor.ts`'s precedent, which this follows). The
 * walk is a decision over a node's type, its children and its attributes — those are the inputs, and a
 * real `Element`/`Text` satisfies {@link TextModelNode} unchanged, so production code hands this the
 * real body and a test hands it a plain object tree.
 */
import { Text as CodeMirrorText } from '@codemirror/state';
import { editorMatches, type Match, type MatchModes } from '@throng/core';

/** DOM's own node-type constants, restated so this file needs no `Node` global (Node-environment tests). */
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * The minimal shape the walk needs — satisfied unchanged by a real `Element`/`Text` node, and by a
 * plain object in a unit test. `childNodes` is `ArrayLike` (a real `NodeList` is not a JS array).
 */
export interface TextModelNode {
  readonly nodeType: number;
  readonly nodeValue?: string | null;
  readonly childNodes: ArrayLike<TextModelNode>;
  getAttribute?(name: string): string | null;
}

/** One contiguous run of the model's text that came from a single DOM text node. */
export interface OffsetEntry {
  readonly from: number;
  readonly to: number;
  readonly node: TextModelNode;
}

/** The rendered text the reader can find, and the map back from a matched offset to its DOM node. */
export interface PreviewTextModel {
  readonly text: string;
  readonly entries: readonly OffsetEntry[];
}

function hasClass(node: TextModelNode, name: string): boolean {
  const raw = node.getAttribute?.('class');
  if (raw === null || raw === undefined) return false;
  return raw.split(/\s+/).includes(name);
}

/**
 * The default exclusion (R1): the fold gutter/toggle controls (`.preview-fold-toggle`,
 * `.preview-fold-gutter` — `contracts/menus-commands-controls.md` "Gutter controls"), and anything
 * `aria-hidden="true"`.
 */
export function defaultPreviewSearchExclusion(node: TextModelNode): boolean {
  return (
    node.getAttribute?.('aria-hidden') === 'true' ||
    hasClass(node, 'preview-fold-toggle') ||
    hasClass(node, 'preview-fold-gutter')
  );
}

/** Walk `root`'s text nodes in document order, skipping any element `isExcluded` accepts (and its subtree). */
export function buildPreviewTextModel(
  root: TextModelNode,
  isExcluded: (node: TextModelNode) => boolean = defaultPreviewSearchExclusion,
): PreviewTextModel {
  let text = '';
  const entries: OffsetEntry[] = [];

  const walk = (node: TextModelNode): void => {
    if (node.nodeType === ELEMENT_NODE && isExcluded(node)) return;
    if (node.nodeType === TEXT_NODE) {
      const value = node.nodeValue ?? '';
      if (value.length > 0) {
        entries.push({ from: text.length, to: text.length + value.length, node });
        text += value;
      }
      return;
    }
    for (let i = 0; i < node.childNodes.length; i += 1) walk(node.childNodes[i]!);
  };
  walk(root);

  return { text, entries };
}

/**
 * The (node, node-local offset) an absolute model offset falls in, for building a `Range`. Valid one
 * past a node's last character too (a `Range` boundary there is ordinary — the end of a match that
 * lands exactly at a text-node join). `null` past the end of the model.
 */
export function locate(model: PreviewTextModel, offset: number): { node: TextModelNode; offset: number } | null {
  const { entries } = model;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    // Half-open [from, to) — an offset sitting exactly on a join belongs to the node that STARTS
    // there, not the one that ends there, so a match beginning at a join lands in the right node.
    // The one exception is the model's very last character-past-the-end (locate(model, text.length)),
    // which has no next entry to claim it: the final entry answers for it too.
    const isLast = i === entries.length - 1;
    if (offset >= entry.from && (offset < entry.to || (isLast && offset === entry.to))) {
      return { node: entry.node, offset: offset - entry.from };
    }
  }
  return null;
}

/**
 * Every match of `term` in the model's rendered text, through core's `editorMatches` — the SAME
 * matcher the editor uses, so match-case / whole-word behave identically here (FR-001).
 */
export function findPreviewMatches(model: PreviewTextModel, term: string, modes: MatchModes): Match[] {
  if (term.length === 0 || model.text.length === 0) return [];
  return editorMatches(CodeMirrorText.of(model.text.split('\n')), term, modes);
}

/**
 * The heading model shared by the preview outline, fold points and #375's editor outline (047,
 * data-model.md "DocumentSymbol", research R2).
 *
 * `HeadingRecord` is the FLAT, document-order shape a producer emits — the Markdown pipeline (per
 * rendered heading: `headingText`, `headingSlug`, its source line) and the editor's Lezer-tree walk
 * both build one, through the same two shared functions, so a heading slugs identically on both
 * sides. `buildSymbolTree` nests that flat list by level: a heading deeper than its predecessor by
 * more than one level (h1 then h4) is still nested as its child — there is no such thing as a
 * "skipped" level in the tree, only in the numbering.
 *
 * Pure: no OS, no DOM, no markdown-it, no CodeMirror.
 */

export interface HeadingRecord {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** The heading's rendered text (inline markup stripped). */
  text: string;
  /** `headingSlug(text, taken)` in document order — unique within the document. */
  slug: string;
  /** 0-based source line of the heading (setext: its text line). */
  line: number;
}

export interface DocumentSymbol {
  name: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  line: number;
  slug: string;
  children: DocumentSymbol[];
}

/**
 * Nests a flat, document-order `HeadingRecord[]` into a `DocumentSymbol[]` tree: each heading
 * becomes the child of the nearest preceding heading of a strictly lower level, however far back
 * that predecessor is (an h4 right after an h1 nests three deep, not one). Headings sharing no such
 * predecessor are siblings at the top.
 *
 * A single pass with a stack of open ancestors, popped while the incoming level is not deeper than
 * the stack's top — O(n) and stable under any level jump, forward or backward.
 */
export function buildSymbolTree(flat: readonly HeadingRecord[]): DocumentSymbol[] {
  const roots: DocumentSymbol[] = [];
  const stack: DocumentSymbol[] = [];

  for (const record of flat) {
    const symbol: DocumentSymbol = {
      name: record.text,
      level: record.level,
      line: record.line,
      slug: record.slug,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= record.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(symbol);
    else roots.push(symbol);
    stack.push(symbol);
  }

  return roots;
}

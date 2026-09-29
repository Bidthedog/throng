/**
 * The editor's own heading model (047 T007, research R2, data-model.md "DocumentSymbol") — derived
 * from the CodeMirror Lezer tree rather than markdown-it's tokens, but built from the SAME two core
 * functions the Markdown pipeline uses (`preview/providers/markdown/pipeline.ts`'s `blockAttributes`)
 * so a heading slugs identically on both sides: `markdownInlineText` resolves what the heading line
 * RENDERS as (stripping `[links](x)`, `` `code` ``, `_emphasis_`, entities — the same table
 * `inline-text.ts` documents), and `headingSlug` de-duplicates it against one Set threaded through
 * the whole document, in document order. `heading-slug-parity.test.ts` (T006) is what holds the two
 * producers to this.
 *
 * `ATXHeading1`–`6` and `SetextHeading1`–`2` are the Lezer grammar's own heading nodes — it never
 * parses a `#` inside a fenced or indented code block, or inside raw HTML, as one of these, so no
 * extra filtering is needed for either (R2's "already excludes code blocks and front matter's `#`").
 * Front matter still needs an explicit skip: `splitFrontMatter` tells this how many leading lines the
 * fence occupies, and any heading node found before that line is a value inside the fence, not a
 * heading — `title: "# not a heading"` parses as an ordinary paragraph, but nothing stops a line that
 * genuinely starts with `#` there from parsing as a real ATX heading node, so the line check is what
 * the pipeline gets for free by never handing the fence to markdown-it at all.
 */
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { headingSlug, markdownInlineText, splitFrontMatter, type HeadingRecord } from '@throng/core';

const HEADING_LEVEL: Readonly<Record<string, HeadingRecord['level']>> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
  SetextHeading1: 1,
  SetextHeading2: 2,
};

/**
 * An ATX heading's SOURCE line with its `#` markers removed (leading, and CommonMark's optional
 * closing sequence); a Setext heading's text line needs none of this and passes through untouched —
 * neither pattern can match it, since it carries no `#`.
 */
function headingLineText(raw: string): string {
  return raw
    .replace(/^#{1,6}(?=[ \t]|$)[ \t]*/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .trim();
}

/**
 * Every heading in `state`'s document, in document order — the editor-side half of R2's shared
 * model. Core's `buildSymbolTree` nests the flat list into a `DocumentSymbol[]` tree; this only
 * extracts it, exactly as the pipeline's own heading pass is flat.
 *
 * `ensureSyntaxTree` forces a full synchronous parse rather than reading whatever background parsing
 * has reached so far — folding and #375's outline both need every heading, not just the ones inside
 * the viewport parsed so far.
 */
export function markdownHeadingRecords(state: EditorState): HeadingRecord[] {
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 5000) ?? syntaxTree(state);
  const { bodyLineOffset } = splitFrontMatter(doc.toString());
  const taken = new Set<string>();
  const records: HeadingRecord[] = [];

  tree.iterate({
    enter: (node) => {
      const level = HEADING_LEVEL[node.type.name];
      if (level === undefined) return;
      const line = doc.lineAt(node.from);
      const line0 = line.number - 1; // CodeMirror lines are 1-based; the shared model is 0-based
      if (line0 < bodyLineOffset) return; // inside the front-matter fence — a value, not a heading
      const text = markdownInlineText(headingLineText(line.text));
      const slug = headingSlug(text, taken);
      records.push({ level, text, slug, line: line0 });
    },
  });

  return records;
}

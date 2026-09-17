/**
 * The Markdown provider's heading grammar for FR-090d (044, fix round 1 item 3).
 *
 * `markdownHeadingLine` is the caret line the editor's FR-090d heading reveal (`reveal-range.ts`)
 * resolves a followed `other.md#heading` link against. What a heading IS, and where one starts, is
 * Markdown's own grammar — so this lives with the Markdown provider, not in the shared
 * `preview/links.ts` every provider's links pass through. Its only non-test caller stays the editor
 * reveal; a new preview provider needs no edit here, and no other provider's grammar belongs beside it.
 *
 * It still reads `headingSlug` (the GitHub-style slugger every provider's rendered headings could use)
 * and `splitFrontMatter` from the shared preview modules — importing FROM the shared layer is normal;
 * it is a shared surface importing a PROVIDER that FR-070 forbids, and neither of those is that.
 */
import { headingSlug } from '../../links.js';
import { splitFrontMatter } from '../../front-matter.js';
import { markdownInlineText } from './inline-text.js';

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const QUOTE_MARKER = /^ {0,3}> ?/;
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
/** `---`, `* * *`, `___` — a rule, which is neither a list item nor a paragraph. */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/** A paragraph that a following setext underline could still turn into a heading. */
interface OpenParagraph {
  /** 0-based line the paragraph starts on. */
  line: number;
  text: string;
  /** Block-quote depth it opened at. */
  depth: number;
  /** Whether it opened a list item. */
  listItem: boolean;
}

/** `line` with its block-quote markers removed, and how deep the quote is. */
function stripQuotes(line: string): { quoted: string; depth: number } {
  let quoted = line;
  let depth = 0;
  for (let marker = QUOTE_MARKER.exec(quoted); marker; marker = QUOTE_MARKER.exec(quoted)) {
    quoted = quoted.slice(marker[0].length);
    depth += 1;
  }
  return { quoted, depth };
}

const isBlank = (ch: string | undefined): boolean => ch === ' ' || ch === '\t';

/**
 * An ATX heading's content with its optional closing `#` sequence removed — one that is the whole content,
 * or is preceded by a space or tab. Trailing blanks may remain; the caller trims.
 *
 * A scan from the end, not `/(?:^|[ \t]+)#+[ \t]*$/`: unanchored at its start, that regex retried from
 * every blank in a long run that is not followed by a closing sequence, and a heading with 100,000 spaces
 * in it took ten seconds (adversarial review, hardening).
 */
function withoutClosingSequence(content: string): string {
  let end = content.length;
  while (end > 0 && isBlank(content[end - 1])) end -= 1;
  let hashes = end;
  while (hashes > 0 && content[hashes - 1] === '#') hashes -= 1;
  if (hashes === end) return content;
  return hashes === 0 || isBlank(content[hashes - 1]) ? content.slice(0, hashes) : content;
}

/** `line` with its list-item markers removed (`- > - ` nests), and whether it opened a list item. */
function stripListItems(line: string): { inner: string; listItem: boolean } {
  let inner = line;
  let listItem = false;
  for (;;) {
    if (THEMATIC_BREAK.test(inner)) break;
    const marker = LIST_MARKER.exec(inner) ?? (listItem ? QUOTE_MARKER.exec(inner) : null);
    if (!marker) break;
    listItem = true;
    inner = inner.slice(marker[0].length);
  }
  return { inner, listItem };
}

/**
 * The 1-based line of the heading `fragment` names in Markdown `text`, or `null` (FR-090d).
 *
 * Headings are slugged in document order with one shared de-duplicating Set — the same numbering the
 * rendered preview gives them — so `#install-1` finds the second "Install". Each is slugged from its
 * RENDERED text (`markdownInlineText`, 044 T178, FR-090b/FR-090f), as the preview slugs markdown-it's
 * inline tokens: `## [Foo](bar.md) baz` answers to `#foo-baz` in both. ATX and setext headings
 * count, INCLUDING those inside block quotes and list items: markdown-it renders `> ## Install` and
 * `- ## Install` as headings and the preview slugs them, so skipping them would leave this numbering
 * one behind the preview's from that point on. Front matter, fenced code (in or out of a quote) and
 * indented code do not count.
 *
 * This is a line scanner, not a CommonMark parser. It follows the block structure that decides
 * heading ORDER — containers, fences, rules, setext underlines — and nothing finer.
 */
export function markdownHeadingLine(text: string, fragment: string): number | null {
  const target = headingSlug(fragment, new Set());
  if (target.length === 0) return null;

  const lines = text.split(/\r\n|\n|\r/);
  const taken = new Set<string>();
  let fence: string | null = null;
  let paragraph: OpenParagraph | null = null;

  for (let i = splitFrontMatter(text).bodyLineOffset; i < lines.length; i += 1) {
    const { quoted, depth } = stripQuotes(lines[i]);

    if (fence !== null) {
      const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      if (close.test(quoted)) fence = null;
      continue;
    }

    // A setext underline belongs to the paragraph above only inside the same quote, and to a list
    // item's paragraph only when indented into the item — `- item` then `---` is a list and a rule.
    if (
      paragraph !== null &&
      SETEXT_UNDERLINE.test(quoted) &&
      paragraph.depth === depth &&
      (!paragraph.listItem || /^[ \t]{2,}/.test(quoted))
    ) {
      if (headingSlug(markdownInlineText(paragraph.text), taken) === target) return paragraph.line + 1;
      paragraph = null;
      continue;
    }

    const { inner, listItem } = stripListItems(quoted);

    const open = FENCE_OPEN.exec(inner);
    if (open) {
      fence = open[1];
      paragraph = null;
      continue;
    }
    if (THEMATIC_BREAK.test(inner)) {
      paragraph = null;
      continue;
    }
    if (ATX.test(inner)) {
      const content = withoutClosingSequence(inner.replace(/^ {0,3}#{1,6}[ \t]*/, '')).trim();
      if (headingSlug(markdownInlineText(content), taken) === target) return i + 1;
      paragraph = null;
      continue;
    }

    if (inner.trim().length === 0) {
      paragraph = null;
    } else if (listItem) {
      paragraph = { line: i, text: inner.trim(), depth, listItem };
    } else if (paragraph !== null) {
      const open: OpenParagraph = paragraph;
      paragraph = { line: open.line, text: `${open.text} ${inner.trim()}`, depth: open.depth, listItem: open.listItem };
    } else if (!INDENTED_CODE.test(inner)) {
      paragraph = { line: i, text: inner.trim(), depth, listItem };
    }
  }
  return null;
}

/**
 * Recognising a YAML front matter block (044, FR-085, research R4).
 *
 * Only the SPLIT lives in core. Parsing the YAML is the renderer's (`yaml.parseDocument`), because a
 * parser is a dependency core has no need to carry and the split is the part every consumer — the
 * pipeline, and `markdownHeadingLine` skipping the block — must agree on.
 *
 * The boundary, exactly: a `---` line that is the document's FIRST line (after an optional byte-order
 * mark), closed by the next line that is also `---`. Trailing spaces and tabs are allowed on both; an
 * indented fence, four dashes, or trailing text is not a fence. No closing fence means no front matter
 * at all — the `---` is then a horizontal rule, which is what CommonMark already makes of it.
 *
 * Pure: no OS, no DOM.
 */

export interface FrontMatterSplit {
  /** The text between the fences, without the line break before the closing one; `null` when none. */
  source: string | null;
  /** Everything after the closing fence's line break — or the whole text when there is no block. */
  body: string;
  /**
   * How many lines precede the body (both fences included), so a body line `n` is document line
   * `n + bodyLineOffset` — what keeps `data-source-line` anchors correct (R11).
   */
  bodyLineOffset: number;
}

const FENCE = /^---[ \t]*$/;
const BOM = String.fromCharCode(0xfeff);

/** Each line of `text` with the offset just past its line break (CRLF, LF or CR). */
function* lines(text: string, from: number): Generator<{ line: string; start: number; next: number }> {
  let start = from;
  while (start <= text.length) {
    const rest = text.slice(start);
    const br = /\r\n|\n|\r/.exec(rest);
    if (!br) {
      yield { line: rest, start, next: text.length + 1 };
      return;
    }
    yield { line: rest.slice(0, br.index), start, next: start + br.index + br[0].length };
    start += br.index + br[0].length;
  }
}

export function splitFrontMatter(text: string): FrontMatterSplit {
  const none: FrontMatterSplit = { source: null, body: text, bodyLineOffset: 0 };
  const from = text.startsWith(BOM) ? BOM.length : 0;

  const iterator = lines(text, from);
  const first = iterator.next();
  // An opening fence with nothing after it cannot be closed.
  if (first.done || !FENCE.test(first.value.line) || first.value.next > text.length) return none;

  let count = 1;
  for (const { line, start, next } of iterator) {
    count += 1;
    if (!FENCE.test(line)) continue;
    const sourceEnd = Math.max(first.value.next, lineBreakStart(text, start));
    return {
      source: text.slice(first.value.next, sourceEnd),
      body: next > text.length ? '' : text.slice(next),
      bodyLineOffset: count,
    };
  }
  return none;
}

/** The offset of the line break that ends the line before `lineStart`. */
function lineBreakStart(text: string, lineStart: number): number {
  if (text.slice(lineStart - 2, lineStart) === '\r\n') return lineStart - 2;
  return lineStart - 1;
}

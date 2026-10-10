/**
 * Where a Find in Files match is in what a preview DREW (054 FR-031, FR-032, research R8).
 *
 * A search finds a match in the SOURCE; a preview shows rendered text. The two meet at the block: the
 * match's source line names the block that holds it (`data-source-line`, the greatest at or before the
 * line, the innermost on a tie), and the matched text is then found in that block's rendered text with the
 * preview's own find model — so `**bold**` searched as `bold` lands on the bold word, and a match in
 * something the find model leaves out (a diagram, hidden front matter, raw HTML that renders no text)
 * is not found, and the caller opens the editor instead.
 *
 * Several occurrences in one block are told apart by counting: the k-th occurrence after the block's first
 * source line is taken to be the k-th in its rendered text. Provider-agnostic: a body that marks its blocks
 * with `data-source-line` is all it needs.
 */
import { buildPreviewTextModel, findPreviewMatches, locate } from './preview-search-model.js';

export interface MatchToReveal {
  from: number;
  text: string;
  /** The match's 0-based source line; derived from `from` when absent. */
  line: number | null;
}

/** The offset of the start of 0-based `line` in `source` (every line-ending style is one break). */
function lineStart(source: string, line: number): number {
  const ending = /\r\n|\r|\n/g;
  let at = 0;
  for (let i = 0; i < line; i += 1) {
    const m = ending.exec(source);
    if (m === null) return source.length;
    at = m.index + m[0].length;
  }
  return at;
}

function lineOf(source: string, offset: number): number {
  return (source.slice(0, offset).match(/\r\n|\r|\n/g) ?? []).length;
}

/** The innermost block whose source line is the greatest at or before `line`. */
function blockFor(host: HTMLElement, line: number): { element: HTMLElement; line: number } | null {
  let found: { element: HTMLElement; line: number } | null = null;
  for (const el of host.querySelectorAll<HTMLElement>('[data-source-line]')) {
    const at = Number(el.getAttribute('data-source-line'));
    if (!Number.isFinite(at) || at > line) continue;
    if (found === null || at >= found.line) found = { element: el, line: at };
  }
  return found;
}

/** A `Range` over the rendered match, or `null` when the drawn preview does not show it. */
export function locateRevealRange(host: HTMLElement, source: string, match: MatchToReveal): Range | null {
  if (match.text.length === 0) return null;
  const line = match.line ?? lineOf(source, match.from);
  const block = blockFor(host, line);
  if (block === null) return null;
  const model = buildPreviewTextModel(block.element);
  const matches = findPreviewMatches(model, match.text, { caseSensitive: true, wholeWord: false });
  if (matches.length === 0) return null;
  // Which occurrence: how many came before it in the block's source.
  const before = source.slice(lineStart(source, block.line), Math.max(match.from, 0));
  let k = 0;
  for (let at = before.indexOf(match.text); at >= 0; at = before.indexOf(match.text, at + match.text.length)) k += 1;
  const chosen = matches[Math.min(k, matches.length - 1)]!;
  const start = locate(model, chosen.from);
  const end = locate(model, chosen.to);
  if (start === null || end === null) return null;
  const range = host.ownerDocument.createRange();
  range.setStart(start.node as Node, start.offset);
  range.setEnd(end.node as Node, end.offset);
  return range;
}

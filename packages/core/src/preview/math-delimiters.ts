/**
 * Where maths starts and ends in Markdown, by GitHub's rules (075, FR-040, FR-041, research R5).
 *
 * Pure scanners over prose. The Markdown pipeline's inline and block rules call them; markdown-it has already
 * tokenised code spans and code blocks (nothing in them is ever offered here) and its escape rule owns a `\$`
 * that is not inside an expression.
 *
 * - `$…$`: the opener is not followed by whitespace (or another `$`); the closer is not preceded by whitespace,
 *   not escaped, and not followed by a digit — so `costs $5 and $10` stays prose.
 * - `` $`…`$ ``: GitHub's code-span form, for an expression holding characters Markdown would otherwise read.
 * - `$$…$$` inside a line: display maths.
 * - A block: a line starting `$$`, then lines, then a line ending `$$` (or one line `$$…$$`). A blank line ends
 *   it unclosed, as it would end a paragraph, and an unclosed block is prose.
 *
 * No OS, no DOM.
 */

export type InlineMathOpen = '$' | '$`' | '$$';

export interface InlineMathMatch {
  /** The index just past the closing delimiter. */
  readonly end: number;
  readonly source: string;
  readonly open: InlineMathOpen;
}

export interface DisplayMathBlock {
  /** The block's last line, inclusive. */
  readonly endLine: number;
  readonly source: string;
}

const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';

/** Whether the character at `i` is escaped by an odd run of backslashes before it. */
function escaped(text: string, i: number): boolean {
  let n = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j -= 1) n += 1;
  return n % 2 === 1;
}

/** The maths that opens at `pos` (which must hold a `$`), or `null` when it is prose. */
export function matchInlineMath(text: string, pos: number): InlineMathMatch | null {
  if (pos < 0 || text[pos] !== '$') return null;

  if (text[pos + 1] === '`') {
    const close = text.indexOf('`$', pos + 2);
    if (close < 0 || close === pos + 2) return null;
    return { end: close + 2, source: text.slice(pos + 2, close), open: '$`' };
  }

  if (text[pos + 1] === '$') {
    let from = pos + 2;
    for (;;) {
      const close = text.indexOf('$$', from);
      if (close < 0) return null;
      if (escaped(text, close)) {
        from = close + 1;
        continue;
      }
      const source = text.slice(pos + 2, close);
      return source.trim().length === 0 ? null : { end: close + 2, source, open: '$$' };
    }
  }

  if (isSpace(text[pos + 1])) return null;
  for (let i = pos + 1; i < text.length; i += 1) {
    if (text[i] !== '$' || escaped(text, i)) continue;
    if (isSpace(text[i - 1]) || isDigit(text[i + 1])) continue;
    if (i === pos + 1) return null;
    return { end: i + 1, source: text.slice(pos + 1, i), open: '$' };
  }
  return null;
}

/** The display block starting at line `start` (indentation already removed), or `null` when it is prose. */
export function matchDisplayBlock(lines: readonly string[], start: number): DisplayMathBlock | null {
  const first = lines[start]?.trimEnd() ?? '';
  if (!first.startsWith('$$')) return null;
  const rest = first.slice(2);
  // One line: `$$…$$`.
  if (rest.length >= 2 && rest.endsWith('$$') && !escaped(rest, rest.length - 2)) {
    const source = rest.slice(0, -2);
    return source.trim().length === 0 ? null : { endLine: start, source };
  }
  if (rest.includes('$$')) return null;
  const body: string[] = rest.trim().length > 0 ? [rest] : [];
  for (let line = start + 1; line < lines.length; line += 1) {
    const text = lines[line].trimEnd();
    if (text.trim().length === 0) return null;
    if (text.endsWith('$$') && !escaped(text, text.length - 2)) {
      const last = text.slice(0, -2);
      if (last.trim().length > 0) body.push(last);
      const source = body.join('\n');
      return source.trim().length === 0 ? null : { endLine: line, source };
    }
    body.push(text);
  }
  return null;
}

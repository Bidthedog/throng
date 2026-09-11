/**
 * Remove TypeScript/TSX comments from source text, leaving the CODE — and every string literal
 * inside it — untouched.
 *
 * ══ WHY THIS EXISTS (#379) ══
 *
 * Several guards in this directory work by scanning renderer source text for a pattern: an `Icon`
 * element naming a token, a banned resolver, a raw colour. A source scan is the right shape for
 * those requirements — it discovers usages rather than checking the files someone remembered to
 * list — but a scan over raw text cannot tell a usage from a sentence ABOUT one.
 *
 * So the guard's own subject became undocumentable in the files it guards: writing a comment that
 * spelled out the attribute form failed the build, naming a "token" nobody had written. It happened
 * once for real, in 043, and the workaround was to reword the comment and add a note saying why it
 * could not say what it meant — a worse comment, in the place the reasoning was most needed.
 *
 * The rejected alternative was a per-line opt-out marker. An opt-out that exists is eventually used
 * to silence a real finding, and then the guard is decoration.
 *
 * ══ WHY IT IS A SCANNER AND NOT TWO REGEXES ══
 *
 * The obvious `.replace(/\/\*[\s\S]*?\*\//g, '')` plus a `//`-to-end-of-line pass is wrong in the
 * direction that MATTERS: it eats a `//` inside a string literal — a URL, a UNC path — and takes
 * the rest of that line's real code with it. A guard that silently stops scanning parts of the
 * source is far worse than the papercut being fixed here, so the stripping walks the text in one
 * pass and knows which of the four contexts it is in: code, a quoted string, a template literal
 * (interpolations included), and a regular-expression literal.
 *
 * The regex-literal case is not theoretical either: `/\/\//` — a perfectly ordinary path-separator
 * pattern — contains a literal `//`, and a naive stripper eats the rest of the line from inside it.
 *
 * Newlines inside a stripped comment are preserved, so line numbers in the stripped text still line
 * up with the file on disk.
 */

/** After one of these, a `/` opens a regular-expression literal rather than dividing. */
const REGEX_MAY_FOLLOW_PUNCTUATION = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '^',
  '~',
  '<',
  '>',
]);

/** …and after one of these keywords, likewise (`return /x/.test(s)`). */
const REGEX_MAY_FOLLOW_KEYWORD = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);

/**
 * Whether a `/` appearing after `emitted` can begin a regex literal.
 *
 * Reads backwards from the end rather than trimming or regex-matching the whole accumulated output:
 * this runs once per `/` in the file, so anchoring a pattern at the end of a growing string makes
 * the strip quadratic in file length. Only the last few characters ever decide the answer.
 */
function regexMayFollow(emitted: string): boolean {
  let end = emitted.length;
  while (end > 0 && /\s/u.test(emitted[end - 1]!)) end -= 1;
  if (end === 0) return true;
  if (REGEX_MAY_FOLLOW_PUNCTUATION.has(emitted[end - 1]!)) return true;

  let start = end;
  while (start > 0 && /[A-Za-z0-9_$]/u.test(emitted[start - 1]!)) start -= 1;
  if (start === end) return false;
  if (/[0-9]/u.test(emitted[start]!)) return false;
  return REGEX_MAY_FOLLOW_KEYWORD.has(emitted.slice(start, end));
}

/**
 * The end index (exclusive) of a regex literal starting at `start`, or `-1` if this `/` does not
 * open one after all.
 *
 * A literal cannot span a line, so an unterminated run to end-of-line is the tell that the `/` was
 * really a division we mis-read — `{width / 2}` is the shape that produces it. Reporting `-1` there
 * makes a mis-read cost one emitted `/` instead of swallowing the rest of the line, which is the
 * only failure direction that could hide a real finding.
 */
function endOfRegexLiteral(src: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') return -1;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return i + 1;
    i++;
  }
  return -1;
}

/** The end index (exclusive) of a `'`/`"` string starting at `start`. */
function endOfQuotedString(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return src.length;
}

/**
 * Source text with every comment removed.
 *
 * Everything else is emitted verbatim — string and template contents included — so a scan over the
 * result asks about code and only code.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;

  /** Depth of `{}` nesting inside each open `${…}`, innermost last. Empty means "not in one". */
  const interpolations: number[] = [];
  /** True while scanning the literal part of a template, i.e. between backtick and `${` or backtick. */
  let inTemplate = false;

  while (i < src.length) {
    const ch = src[i]!;

    if (inTemplate) {
      if (ch === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '`') {
        out += ch;
        i += 1;
        inTemplate = false;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        inTemplate = false;
        interpolations.push(0);
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const end = endOfQuotedString(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }

    if (ch === '`') {
      out += ch;
      i += 1;
      inTemplate = true;
      continue;
    }

    if (ch === '/' && regexMayFollow(out)) {
      const end = endOfRegexLiteral(src, i);
      if (end !== -1) {
        out += src.slice(i, end);
        i = end;
        continue;
      }
    }

    if (interpolations.length > 0) {
      if (ch === '{') interpolations[interpolations.length - 1] += 1;
      else if (ch === '}') {
        if (interpolations[interpolations.length - 1] === 0) {
          interpolations.pop();
          inTemplate = true;
          out += ch;
          i += 1;
          continue;
        }
        interpolations[interpolations.length - 1] -= 1;
      }
    }

    out += ch;
    i += 1;
  }

  return out;
}

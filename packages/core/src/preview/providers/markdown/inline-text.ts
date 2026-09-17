/**
 * A Markdown heading's RENDERED text, from its source line (044 T178, FR-090b, FR-090f).
 *
 * ══ WHY IT EXISTS ══
 *
 * A heading is slugged from what the reader SEES, not from what the author typed: `## [Foo](bar.md) baz`
 * reads "Foo baz" and answers to `#foo-baz`, `## <a name="install"></a>Install` reads "Install", and
 * `## _Note_` reads "Note". The rendered preview has markdown-it's inline tokens to read that from
 * (`pipeline.ts`); the editor's heading reveal (`heading-line.ts`, FR-090d) has only the line, and core
 * has no Markdown parser — so this resolves the inline constructs that change a heading's TEXT, and
 * nothing else. The two must agree, or `#install-1` lands on the wrong line in the editor.
 *
 * It is not a CommonMark inline parser and does not try to be. What it resolves:
 *
 * | Source                       | Text            |
 * |------------------------------|-----------------|
 * | `[Foo](bar.md)`              | `Foo`           |
 * | `![alt](a.png)`              | *(nothing — an image is not text on screen)* |
 * | `` `code_span` ``            | `code_span`     |
 * | `<a name="x"></a>`, `<em>`   | *(nothing)*     |
 * | `<https://example.com/>`     | `https://example.com/` |
 * | `_Note_`, `__Note__`         | `Note`          |
 * | `\_literal\_`                | `_literal_`     |
 * | `&amp;`, `&#38;`             | `&`             |
 *
 * `*` and `~` runs are left alone deliberately: `headingSlug` removes them anyway, and leaving them
 * costs nothing. Reference links (`[Foo][ref]`) are left as written, because their definition is not on
 * this line. Underscores are the one emphasis marker that survives slugging (it is connector
 * punctuation), so they are the one that must be resolved — and `snake_case_name` keeps its
 * underscores, exactly as markdown-it renders it, because an intraword `_` opens nothing.
 *
 * ══ LINEAR ══
 *
 * Every scan moves forward only: the next `>`, `<` and `)` are precomputed in one backward pass, and
 * each backtick run's partner is found through a per-length cursor that never rewinds. A heading with
 * 100,000 of any one character is a linear cost here, as the adversarial review's bound requires
 * (`heading-line.test.ts`, `preview-links.test.ts`).
 */

/** Nothing in a line without one of these can change its rendered text — the common case, untouched. */
const INTERESTING = /[\\`<>[\]&_]/;

/** A named entity this resolves; everything else is left as written (a slug drops `&` and `;` anyway). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const ENTITY = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/;
/** `<https://example.com/x>` — an autolink renders as its own text. */
const AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/;
const EMAIL_AUTOLINK = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
/** `<a name="x">`, `</a>`, `<br/>`, `<!-- … -->` — markup, which renders no text of its own. */
const HTML_TAG = /^(?:\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?|!--[\s\S]*--|![A-Za-z][\s\S]*|\?[\s\S]*)$/;

const isWhitespace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
const isPunctuation = (ch: string | undefined): boolean => ch !== undefined && /[\p{P}\p{S}]/u.test(ch);
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/** For every index, the next occurrence of `ch` at or after it, or `-1`. One backward pass. */
function nextIndexOf(source: string, ch: string): Int32Array {
  const next = new Int32Array(source.length + 1);
  next[source.length] = -1;
  for (let i = source.length - 1; i >= 0; i -= 1) next[i] = source[i] === ch ? i : next[i + 1];
  return next;
}

interface Underscores {
  /** Where the run sits in `out`. */
  slot: number;
  canOpen: boolean;
  canClose: boolean;
}

/** A `[`/`![` still looking for its `]`. */
interface Bracket {
  slot: number;
  image: boolean;
}

/**
 * `source` as the rendered heading reads — see the table above. Whitespace, line structure and
 * everything the slugger discards are left exactly as they are.
 */
export function markdownInlineText(source: string): string {
  if (!INTERESTING.test(source)) return source;

  const nextGt = nextIndexOf(source, '>');
  const nextLt = nextIndexOf(source, '<');
  const nextRp = nextIndexOf(source, ')');

  // Backtick runs, in order, plus a per-length cursor into them, so a code span's partner is found
  // without ever rescanning: every cursor only moves forward.
  const runs: { start: number; length: number }[] = [];
  for (let i = 0; i < source.length; ) {
    if (source[i] !== '`') {
      i += 1;
      continue;
    }
    let end = i;
    while (end < source.length && source[end] === '`') end += 1;
    runs.push({ start: i, length: end - i });
    i = end;
  }
  const runAt = new Map<number, number>();
  runs.forEach((run, index) => runAt.set(run.start, index));
  const cursorByLength = new Map<number, number>();

  const out: string[] = [];
  const underscores: Underscores[] = [];
  const brackets: Bracket[] = [];

  for (let i = 0; i < source.length; ) {
    const ch = source[i];

    if (ch === '\\') {
      const next = source[i + 1];
      if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        out.push(next);
        i += 2;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === '`') {
      const index = runAt.get(i)!;
      const { length } = runs[index];
      let cursor = Math.max(cursorByLength.get(length) ?? 0, index + 1);
      while (cursor < runs.length && runs[cursor].length !== length) cursor += 1;
      cursorByLength.set(length, cursor);
      if (cursor >= runs.length) {
        out.push(source.slice(i, i + length));
        i += length;
        continue;
      }
      const close = runs[cursor];
      let content = source.slice(i + length, close.start);
      // CommonMark: one space is stripped from each end when both are spaces and the content is not all spaces.
      if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim().length > 0) {
        content = content.slice(1, -1);
      }
      out.push(content);
      i = close.start + close.length;
      continue;
    }

    if (ch === '<') {
      const gt = nextGt[i];
      const lt = nextLt[i + 1];
      // No `>` at all, or another `<` first: this one is a literal, and no substring is examined twice.
      if (gt === -1 || (lt !== -1 && lt < gt)) {
        out.push(ch);
        i += 1;
        continue;
      }
      const inner = source.slice(i + 1, gt);
      if (AUTOLINK.test(inner) || EMAIL_AUTOLINK.test(inner)) out.push(inner);
      else if (!HTML_TAG.test(inner)) {
        out.push(ch);
        i += 1;
        continue;
      }
      i = gt + 1;
      continue;
    }

    if (ch === '&') {
      const match = ENTITY.exec(source.slice(i, i + 36));
      const [whole, decimal, hex, name] = match ?? [];
      const code = decimal !== undefined ? Number(decimal) : hex !== undefined ? Number.parseInt(hex, 16) : null;
      const named = name !== undefined ? NAMED_ENTITIES[name.toLowerCase()] : undefined;
      if (code !== null && Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        out.push(String.fromCodePoint(code));
        i += whole!.length;
        continue;
      }
      if (named !== undefined) {
        out.push(named);
        i += whole!.length;
        continue;
      }
      out.push(ch);
      i += 1;
      continue;
    }

    if (ch === '!' && source[i + 1] === '[') {
      brackets.push({ slot: out.length, image: true });
      out.push('![');
      i += 2;
      continue;
    }

    if (ch === '[') {
      brackets.push({ slot: out.length, image: false });
      out.push('[');
      i += 1;
      continue;
    }

    if (ch === ']') {
      const opener = brackets.pop();
      const inlineDestination = opener !== undefined && source[i + 1] === '(' ? nextRp[i + 1] : -1;
      if (opener === undefined || inlineDestination === -1) {
        out.push(ch);
        i += 1;
        continue;
      }
      // A link renders its text and drops its markers; an image renders nothing at all.
      if (opener.image) for (let slot = opener.slot; slot < out.length; slot += 1) out[slot] = '';
      else out[opener.slot] = '';
      i = inlineDestination + 1;
      continue;
    }

    if (ch === '_') {
      let end = i;
      while (end < source.length && source[end] === '_') end += 1;
      const before = i === 0 ? undefined : source[i - 1];
      const after = source[end];
      const leftFlanking = !isWhitespace(after) && (!isPunctuation(after) || isWhitespace(before) || isPunctuation(before));
      const rightFlanking = !isWhitespace(before) && (!isPunctuation(before) || isWhitespace(after) || isPunctuation(after));
      // An intraword `_` opens and closes nothing — `snake_case_name` keeps every underscore it has.
      underscores.push({
        slot: out.length,
        canOpen: leftFlanking && (!rightFlanking || isPunctuation(before)),
        canClose: rightFlanking && (!leftFlanking || isPunctuation(after)),
      });
      out.push(source.slice(i, end));
      i = end;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  // Emphasis: each closer takes the nearest opener still waiting, and both runs stop being text.
  const open: Underscores[] = [];
  for (const run of underscores) {
    if (run.canClose && open.length > 0) {
      out[open.pop()!.slot] = '';
      out[run.slot] = '';
      continue;
    }
    if (run.canOpen) open.push(run);
  }

  return out.join('');
}
